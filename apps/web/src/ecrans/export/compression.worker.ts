/**
 * Worker de compression de l'export (T16b) : deflate brut (`CompressionStream('deflate-raw')`)
 * hors du fil principal. Mesuré dans le navigateur (hors ligne, CPU ×4, ferme de T07) : la
 * compression faite sur le fil principal y prenait ≈ 4,5 s sur ≈ 8 s de construction de
 * l'archive ; ici, elle se fait pendant que le fil principal écrit les CSV suivants.
 *
 * Protocole (./compression.ts) : chaque entrée de l'archive est un flux numéroté.
 *   reçu  { type: 'bonjour' } | { id, type: 'morceau', octets } | { id, type: 'fin' } | { id, type: 'abandon' }
 *   rendu { type: 'pret' } (réponse à « bonjour » : le script est chargé)
 *         | { id, type: 'recu', taille } (morceau reçu pris par le flux : contre-pression, T15c)
 *         | { id, type: 'morceau', octets } (tampon transféré) | { id, type: 'fin' } | { id, type: 'erreur', message }
 */
import type { MessageCompression, ReponseCompression } from './compression.ts';

interface Flux {
  readonly ecrivain: WritableStreamDefaultWriter<BufferSource>;
  readonly lecteur: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>;
}

const flux = new Map<number, Flux>();
/** Flux abandonnés : un message en retard ne les rouvre pas. */
const abandonnes = new Set<number>();

function repondre(r: ReponseCompression): void {
  if (r.type === 'morceau') self.postMessage(r, { transfer: [r.octets.buffer] });
  else self.postMessage(r);
}

/** Lit la sortie compressée d'un flux et la renvoie, morceau par morceau. */
async function renvoyer(id: number, lecteur: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>): Promise<void> {
  try {
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      repondre({ id, type: 'morceau', octets: value });
    }
    repondre({ id, type: 'fin' });
  } catch (erreur: unknown) {
    // Abandon demandé : le lecteur est annulé, rien à dire.
    if (flux.has(id)) repondre({ id, type: 'erreur', message: erreur instanceof Error ? erreur.message : String(erreur) });
  } finally {
    flux.delete(id);
  }
}

function ouvrir(id: number): Flux {
  const existant = flux.get(id);
  if (existant !== undefined) return existant;
  const compression = new CompressionStream('deflate-raw');
  const f: Flux = { ecrivain: compression.writable.getWriter(), lecteur: compression.readable.getReader() };
  flux.set(id, f);
  void renvoyer(id, f.lecteur);
  return f;
}

self.onmessage = (e: MessageEvent<MessageCompression>) => {
  const m = e.data;
  if (m.type === 'bonjour') {
    repondre({ type: 'pret' });
    return;
  }
  // Accusé de réception d'un morceau : il libère sa place côté page (contre-pression, T15c).
  const recu = () => {
    if (m.type === 'morceau') repondre({ id: m.id, type: 'recu', taille: m.octets.byteLength });
  };
  if (abandonnes.has(m.id)) {
    recu();
    return;
  }
  if (m.type === 'abandon') {
    abandonnes.add(m.id);
    const f = flux.get(m.id);
    flux.delete(m.id);
    f?.lecteur.cancel().catch(() => undefined);
    f?.ecrivain.abort().catch(() => undefined);
    return;
  }
  const f = ouvrir(m.id);
  // Écritures mises en file dans l'ordre ; une erreur arrive par le lecteur (renvoyer).
  // Reçu par clonage structuré : toujours un ArrayBuffer ordinaire (jamais partagé).
  // L'accusé part quand le flux a pris le morceau : la contre-pression va jusqu'au deflate.
  if (m.type === 'morceau') f.ecrivain.write(m.octets as Uint8Array<ArrayBuffer>).then(recu, recu);
  else f.ecrivain.close().catch(() => undefined);
};
